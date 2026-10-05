import { Router, type IRouter } from "express";
import healthRouter from "./health";
import notificationsRouter from "./notifications";
import livekitRouter from "./livekit";
import walletRouter from "./wallet";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/notifications", notificationsRouter);
router.use("/livekit", livekitRouter);
router.use("/wallet", walletRouter);

export default router;
