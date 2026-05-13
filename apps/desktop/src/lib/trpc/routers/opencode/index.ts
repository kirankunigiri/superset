import { getOpenCodeManager } from "main/lib/opencode";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createOpenCodeRouter = () =>
	router({
		getUrl: publicProcedure
			.input(z.object({ folderPath: z.string().min(1) }))
			.mutation(async ({ input }) => {
				const manager = getOpenCodeManager();
				const url = await manager.ensureRunning(input.folderPath);
				return { url };
			}),
	});
