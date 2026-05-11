#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	closePane,
	createPane,
	focusPane,
	listPanes,
	readTerminal,
	writeTerminal,
} from "../lib/desktop-automation";

function textResult(value: unknown) {
	const text =
		typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text" as const, text: message }],
		isError: true,
	};
}

const server = new McpServer(
	{ name: "superset-panes", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

server.registerTool(
	"list_panes",
	{
		description:
			"List all panes in the desktop app. Returns pane IDs, types, and names.",
		inputSchema: {
			workspaceId: z
				.string()
				.optional()
				.describe("Workspace ID (auto-detected)"),
			type: z
				.enum([
					"terminal",
					"webview",
					"chat",
					"file-viewer",
					"devtools",
					"comment",
				])
				.optional()
				.describe("Filter by pane type"),
		},
	},
	async (args) => {
		try {
			const panes = await listPanes({
				workspaceId: args.workspaceId,
				type: args.type,
			});
			return textResult(panes);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"create_terminal_pane",
	{
		description:
			"Create a new terminal pane. Opens in a new tab by default, or splits the active pane with --split.",
		inputSchema: {
			workspaceId: z
				.string()
				.optional()
				.describe("Workspace ID (auto-detected)"),
			cwd: z.string().optional().describe("Starting directory"),
			cmd: z.string().optional().describe("Command to run after creation"),
			split: z
				.enum(["right", "below"])
				.optional()
				.describe("Split the active pane in this direction"),
		},
	},
	async (args) => {
		try {
			const result = await createPane({
				type: "terminal",
				workspaceId: args.workspaceId,
				initialCwd: args.cwd,
				split: args.split,
				command: args.cmd,
			});
			return textResult(result);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"create_browser_pane",
	{
		description:
			"Create a new browser pane. To interact with it afterward, use the superset-browser MCP tools (list_pages, select_page, click, etc.).",
		inputSchema: {
			workspaceId: z
				.string()
				.optional()
				.describe("Workspace ID (auto-detected)"),
			url: z.string().optional().describe("URL to open"),
			split: z
				.enum(["right", "below"])
				.optional()
				.describe("Split the active pane in this direction"),
		},
	},
	async (args) => {
		try {
			const result = await createPane({
				type: "browser",
				workspaceId: args.workspaceId,
				url: args.url,
				split: args.split,
			});
			return textResult(result);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"create_chat_pane",
	{
		description: "Create a new AI chat pane.",
		inputSchema: {
			workspaceId: z
				.string()
				.optional()
				.describe("Workspace ID (auto-detected)"),
			split: z
				.enum(["right", "below"])
				.optional()
				.describe("Split the active pane in this direction"),
		},
	},
	async (args) => {
		try {
			const result = await createPane({
				type: "chat",
				workspaceId: args.workspaceId,
				split: args.split,
			});
			return textResult(result);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"create_file_pane",
	{
		description: "Open a file in the editor. Requires an absolute file path.",
		inputSchema: {
			filePath: z.string().describe("Absolute path to the file"),
			workspaceId: z
				.string()
				.optional()
				.describe("Workspace ID (auto-detected)"),
			split: z
				.enum(["right", "below"])
				.optional()
				.describe("Split the active pane in this direction"),
		},
	},
	async (args) => {
		try {
			const result = await createPane({
				type: "file",
				workspaceId: args.workspaceId,
				filePath: args.filePath,
				split: args.split,
			});
			return textResult(result);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"close_pane",
	{
		description: "Close a pane by ID.",
		inputSchema: {
			paneId: z.string().describe("Pane ID from list_panes"),
		},
	},
	async (args) => {
		try {
			await closePane(args.paneId);
			return textResult({ paneId: args.paneId, closed: true });
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"focus_pane",
	{
		description: "Focus a pane and activate its tab.",
		inputSchema: {
			paneId: z.string().describe("Pane ID from list_panes"),
		},
	},
	async (args) => {
		try {
			const result = await focusPane(args.paneId);
			return textResult(result);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"read_pane",
	{
		description: "Read terminal buffer content including scrollback.",
		inputSchema: {
			paneId: z.string().describe("Terminal pane ID"),
			lines: z
				.number()
				.optional()
				.describe("Number of lines from the end (default: all)"),
		},
	},
	async (args) => {
		try {
			const { content } = await readTerminal({
				paneId: args.paneId,
				lines: args.lines,
			});
			return textResult(content);
		} catch (error) {
			return errorResult(error);
		}
	},
);

server.registerTool(
	"send_command",
	{
		description: "Type and execute a command in a terminal pane.",
		inputSchema: {
			paneId: z.string().describe("Terminal pane ID"),
			cmd: z
				.string()
				.describe("Command to send (newline appended automatically)"),
		},
	},
	async (args) => {
		try {
			await writeTerminal({
				paneId: args.paneId,
				data: `${args.cmd}\n`,
			});
			return textResult({ paneId: args.paneId, sent: args.cmd });
		} catch (error) {
			return errorResult(error);
		}
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
