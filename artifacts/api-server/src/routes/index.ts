import { Router, type IRouter } from "express";
import healthRouter from "./health";
import notificationsRouter from "./notifications";
import livekitRouter from "./livekit";
import walletRouter from "./wallet";
import roomsRouter from "./rooms";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/notifications", notificationsRouter);
router.use("/livekit", livekitRouter);
router.use("/wallet", walletRouter);
router.use("/rooms", roomsRouter);

export default router;
