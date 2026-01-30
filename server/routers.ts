import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { conjugate, verbTypes, exampleVerbs, VerbType, detectVerbType } from "./conjugation";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // 动词活用 API
  verb: router({
    // 自动识别并获取动词活用结果
    conjugate: publicProcedure
      .input(z.object({
        verb: z.string().min(1),
        type: z.enum(['GODAN', 'ICHIDAN', 'SURU', 'KURU']).optional()
      }))
      .query(({ input }) => {
        const verbType = input.type || detectVerbType(input.verb);
        return conjugate(input.verb, verbType as VerbType);
      }),
    
    // 仅识别动词类型
    detectType: publicProcedure
      .input(z.object({
        verb: z.string().min(1)
      }))
      .query(({ input }) => {
        return { verb: input.verb, type: detectVerbType(input.verb) };
      }),
    
    // 获取动词类型列表
    getTypes: publicProcedure.query(() => verbTypes),
    
    // 获取示例动词
    getExamples: publicProcedure.query(() => exampleVerbs),
  }),
});

export type AppRouter = typeof appRouter;
