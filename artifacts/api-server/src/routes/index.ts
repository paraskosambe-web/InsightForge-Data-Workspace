import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import datasetsRouter from "./datasets";
import modelsRouter from "./models";
import reportsRouter from "./reports";
import analystRouter from "./analyst";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(datasetsRouter);
router.use(modelsRouter);
router.use(reportsRouter);
router.use(analystRouter);

export default router;
