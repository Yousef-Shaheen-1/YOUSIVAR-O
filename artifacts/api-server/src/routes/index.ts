import { Router, type IRouter } from "express";
import healthRouter from "./health";
import contentRouter from "./content";
import integrationsRouter from "./integrations";
import usersRouter from "./users";
import mediaRouter from "./media";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contentRouter);
router.use(integrationsRouter);
router.use(usersRouter);
router.use(mediaRouter);
router.use(storageRouter);

export default router;
