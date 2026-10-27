import { Router, type IRouter } from "express";
import healthRouter from "./health";
import contentRouter from "./content";
import integrationsRouter from "./integrations";
import usersRouter from "./users";
import mediaRouter from "./media";
import storageRouter from "./storage";
import ownerAuthRouter from "./ownerAuth";
import adminTermuxRouter from "./adminTermux";
import adminGithubRouter from "./adminGithub";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ownerAuthRouter);
router.use(contentRouter);
router.use(integrationsRouter);
router.use(adminTermuxRouter);
router.use(adminGithubRouter);
router.use(usersRouter);
router.use(mediaRouter);
router.use(storageRouter);

export default router;
