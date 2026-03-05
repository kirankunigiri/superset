export interface SidebarWorkspace {
	id: string;
	projectId: string;
	worktreePath: string;
	type: "worktree" | "branch";
	branch: string;
	name: string;
	tabOrder: number;
	isUnread: boolean;
}

export interface DragItem {
	id: string;
	projectId: string;
	sectionId: string | null;
	index: number;
	originalIndex: number;
	/** Set by native drop handlers to prevent the end handler from reordering */
	handled?: boolean;
}

export interface SectionDragItem {
	sectionId: string;
	projectId: string;
	index: number;
	originalIndex: number;
}

export interface SidebarSection {
	id: string;
	name: string;
	tabOrder: number;
	isCollapsed: boolean;
	workspaces: SidebarWorkspace[];
}
