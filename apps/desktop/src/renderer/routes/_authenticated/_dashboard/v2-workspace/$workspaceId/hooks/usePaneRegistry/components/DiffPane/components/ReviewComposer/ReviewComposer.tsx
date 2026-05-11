import { Button } from "@superset/ui/button";
import { Kbd } from "@superset/ui/kbd";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { ReviewSelection } from "../../hooks/useReviewCommentSelection";
import { useTerminalPaneTargets } from "../../hooks/useTerminalPaneTargets";

interface ReviewComposerProps {
	workspaceId: string;
	filePath: string;
	selection: ReviewSelection;
	onClose: () => void;
}

function formatInsertText(
	filePath: string,
	selection: ReviewSelection,
	comment: string,
	isStacked: boolean,
): string {
	const lineLabel =
		selection.startLine === selection.endLine
			? `${selection.startLine}`
			: `${selection.startLine}-${selection.endLine}`;
	const ext = filePath.split(".").pop() ?? "";
	const body = [
		`Review comment for ${filePath}:${lineLabel}`,
		comment,
		"",
		`\`\`\`${ext}`,
		selection.code,
		"```",
	].join("\n");

	return isStacked ? `\n\n---\n${body}` : body;
}

const insertedTerminals = new Set<string>();

export function ReviewComposer({
	workspaceId,
	filePath,
	selection,
	onClose,
}: ReviewComposerProps) {
	const { targets } = useTerminalPaneTargets(workspaceId);

	const [selectedTerminalId, setSelectedTerminalId] = useState("");
	const [comment, setComment] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!selectedTerminalId && targets.length > 0) {
			setSelectedTerminalId(targets[0].terminalId);
		}
	}, [targets, selectedTerminalId]);

	useEffect(() => {
		requestAnimationFrame(() => textareaRef.current?.focus());
	}, []);

	const insertComment = useCallback(
		(sendEnter: boolean) => {
			if (!comment.trim() || !selectedTerminalId) return;
			const isStacked = insertedTerminals.has(selectedTerminalId);
			const text = formatInsertText(
				filePath,
				selection,
				comment.trim(),
				isStacked,
			);
			terminalRuntimeRegistry.writeInput(selectedTerminalId, text);
			if (sendEnter) {
				setTimeout(() => {
					terminalRuntimeRegistry.writeInput(selectedTerminalId, "\r");
				}, 50);
			}
			insertedTerminals.add(selectedTerminalId);
			onClose();
		},
		[comment, selectedTerminalId, filePath, selection, onClose],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				insertComment(!e.shiftKey);
			}
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		},
		[insertComment, onClose],
	);

	if (targets.length === 0) {
		return (
			<div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-lg">
				<p className="text-xs text-muted-foreground">
					No terminal panes open. Open a terminal first.
				</p>
				<Button type="button" size="sm" variant="ghost" onClick={onClose}>
					Close
				</Button>
			</div>
		);
	}

	return (
		<div
			role="dialog"
			className="flex w-80 flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-lg"
			onKeyDown={handleKeyDown}
		>
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-foreground">
					Review comment{" "}
					<span className="text-muted-foreground">
						L{selection.startLine}
						{selection.endLine !== selection.startLine &&
							`-${selection.endLine}`}
					</span>
				</span>
				<button
					type="button"
					onClick={onClose}
					className="text-muted-foreground hover:text-foreground"
					aria-label="Close"
				>
					<LuX className="size-3.5" />
				</button>
			</div>

			<Textarea
				ref={textareaRef}
				value={comment}
				onChange={(e) => setComment(e.target.value)}
				placeholder="Write your question or comment..."
				className="min-h-[72px] resize-y text-xs"
				rows={3}
			/>

			<div className="flex items-center gap-2">
				<Select
					value={selectedTerminalId}
					onValueChange={setSelectedTerminalId}
				>
					<SelectTrigger className="h-7 flex-1 text-xs">
						<SelectValue placeholder="Select terminal" />
					</SelectTrigger>
					<SelectContent>
						{targets.map((t) => (
							<SelectItem key={t.terminalId} value={t.terminalId}>
								{t.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Button
					type="button"
					size="sm"
					disabled={!comment.trim()}
					onClick={() => insertComment(true)}
				>
					Send
					<Kbd>⌘+↵</Kbd>
				</Button>
			</div>

			<p className="text-[10px] text-muted-foreground">
				⌘+Shift+Enter to stage multiple comments
			</p>
		</div>
	);
}
