import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { appRouter } from "./trpc/router";

export type { AppRouter } from "./trpc/router";

const app = new Hono();

app.use("/trpc/*", trpcServer({ router: appRouter }));

export default app;
