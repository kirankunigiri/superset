import {
	getVscodeServeWebManager,
	type VscodeVariant,
} from "main/lib/vscode-serve-web";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const variantSchema = z.enum(["vscode", "vscode-insiders"]);

export const createVscodeInlineRouter = () =>
	router({
		isInstalled: publicProcedure
			.input(z.object({ variant: variantSchema }))
			.query(({ input }) => {
				return {
					installed: getVscodeServeWebManager().isInstalled(
						input.variant as VscodeVariant,
					),
				};
			}),

		getUrl: publicProcedure
			.input(
				z.object({
					variant: variantSchema,
					folderPath: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getVscodeServeWebManager();
				const baseUrl = await manager.ensureRunning(
					input.variant as VscodeVariant,
				);
				const url = manager.buildFolderUrl(baseUrl, input.folderPath);
				return { url };
			}),

		stop: publicProcedure
			.input(z.object({ variant: variantSchema }))
			.mutation(({ input }) => {
				getVscodeServeWebManager().stop(input.variant as VscodeVariant);
				return { stopped: true };
			}),
	});
