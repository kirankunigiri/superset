import { workspaceSections, workspaces } from "@superset/local-db";
import { eq } from "drizzle-orm";
import { localDb } from "main/lib/local-db";
import { z } from "zod";
import { publicProcedure, router } from "../../..";

export const createSectionsProcedures = () => {
	return router({
		createSection: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					name: z.string(),
				}),
			)
			.mutation(({ input }) => {
				const existing = localDb
					.select()
					.from(workspaceSections)
					.where(eq(workspaceSections.projectId, input.projectId))
					.all();

				const maxTabOrder = existing.reduce(
					(max, s) => Math.max(max, s.tabOrder),
					-1,
				);

				const section = localDb
					.insert(workspaceSections)
					.values({
						projectId: input.projectId,
						name: input.name,
						tabOrder: maxTabOrder + 1,
					})
					.returning()
					.get();

				return section;
			}),

		renameSection: publicProcedure
			.input(
				z.object({
					id: z.string(),
					name: z.string(),
				}),
			)
			.mutation(({ input }) => {
				localDb
					.update(workspaceSections)
					.set({ name: input.name })
					.where(eq(workspaceSections.id, input.id))
					.run();

				return { success: true };
			}),

		deleteSection: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => {
				localDb
					.delete(workspaceSections)
					.where(eq(workspaceSections.id, input.id))
					.run();

				return { success: true };
			}),

		reorderSections: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					fromIndex: z.number(),
					toIndex: z.number(),
				}),
			)
			.mutation(({ input }) => {
				const { projectId, fromIndex, toIndex } = input;

				const sections = localDb
					.select()
					.from(workspaceSections)
					.where(eq(workspaceSections.projectId, projectId))
					.all()
					.sort((a, b) => a.tabOrder - b.tabOrder);

				if (
					fromIndex < 0 ||
					fromIndex >= sections.length ||
					toIndex < 0 ||
					toIndex >= sections.length
				) {
					throw new Error("Invalid fromIndex or toIndex");
				}

				const [removed] = sections.splice(fromIndex, 1);
				sections.splice(toIndex, 0, removed);

				for (let i = 0; i < sections.length; i++) {
					localDb
						.update(workspaceSections)
						.set({ tabOrder: i })
						.where(eq(workspaceSections.id, sections[i].id))
						.run();
				}

				return { success: true };
			}),

		toggleSectionCollapsed: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => {
				const section = localDb
					.select()
					.from(workspaceSections)
					.where(eq(workspaceSections.id, input.id))
					.get();

				if (!section) {
					throw new Error(`Section ${input.id} not found`);
				}

				localDb
					.update(workspaceSections)
					.set({ isCollapsed: !section.isCollapsed })
					.where(eq(workspaceSections.id, input.id))
					.run();

				return { success: true, isCollapsed: !section.isCollapsed };
			}),

		reorderWorkspacesInSection: publicProcedure
			.input(
				z.object({
					sectionId: z.string(),
					fromIndex: z.number(),
					toIndex: z.number(),
				}),
			)
			.mutation(({ input }) => {
				const { sectionId, fromIndex, toIndex } = input;

				const sectionWorkspaces = localDb
					.select()
					.from(workspaces)
					.where(eq(workspaces.sectionId, sectionId))
					.all()
					.sort((a, b) => a.tabOrder - b.tabOrder);

				if (
					fromIndex < 0 ||
					fromIndex >= sectionWorkspaces.length ||
					toIndex < 0 ||
					toIndex >= sectionWorkspaces.length
				) {
					throw new Error("Invalid fromIndex or toIndex");
				}

				const [removed] = sectionWorkspaces.splice(fromIndex, 1);
				sectionWorkspaces.splice(toIndex, 0, removed);

				for (let i = 0; i < sectionWorkspaces.length; i++) {
					localDb
						.update(workspaces)
						.set({ tabOrder: i })
						.where(eq(workspaces.id, sectionWorkspaces[i].id))
						.run();
				}

				return { success: true };
			}),

		moveWorkspaceToSection: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					sectionId: z.string().nullable(),
				}),
			)
			.mutation(({ input }) => {
				localDb
					.update(workspaces)
					.set({ sectionId: input.sectionId })
					.where(eq(workspaces.id, input.workspaceId))
					.run();

				return { success: true };
			}),
	});
};
