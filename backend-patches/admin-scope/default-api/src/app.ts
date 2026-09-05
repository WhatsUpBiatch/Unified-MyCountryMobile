import express from "express";
import fs from "fs";
import morgan from "morgan";
import cron from "node-cron";
import swaggerUi from "swagger-ui-express";
import { sequelize } from "./config/database";
import AiRoute from "./routers/aiRoute";
import AiV2Route from "./routers/aiV2Route";
import authRoute from "./routers/authRoute";
import cardRoute from "./routers/cardRoute";
import companySelfRoute from "./routers/companySelfRoute";
import didRoute from "./routers/didRoute";
import didWRoute from "./routers/didWRoute";
import identityRoute from "./routers/IdentityRoute";
import inviteRoute from "./routers/inviteRoute";
import internalRoute from "./routers/internalRoute";
import mediaRoute from "./routers/mediaRoute";
import numberRoute from "./routers/numberRoute";
import paymentRoute from "./routers/paymentRoute";
import planRoute from "./routers/planRoute";
import profileSelfRoute from "./routers/profileSelfRoute";
import siteRoute from "./routers/siteRoute";
import tenantRoute from "./routers/tenantRoute";
import trustedDeviceRoute from "./routers/trustedDeviceRoute";
import userRoute from "./routers/userRoute";
import personStateRoute from "./routers/personStateRoute";
import adminScopeRoute from "./routers/adminScopeRoute";
import validatorRoute from "./routers/validatorRoute";
// import v1RouteOld from "./routers/v1RouteOld";
import bodyParser from "body-parser";
import path from "path";
import CronController from "./controllers/CronController";
import logger from "./middlewares/Logger";
import adminRoute from "./routers/Admin";
import billingRoute from "./routers/billingRoute";
import calendarRoute from "./routers/calendarRoute";
import callQueueRoute from "./routers/callQueueRoute";
import campaignRoute from "./routers/campaignRoute";
import companyLicenseRoute from "./routers/companyLicenseRoute";
import contactRoute from "./routers/contactRoute";
import crmRoute from "./routers/crmRoute";
import dncRoute from "./routers/dncRoute";
import faxRoute from "./routers/faxRoute";
import globalRoute from "./routers/globalRoute";
import omniRoute from "./routers/omniRoute";
import logRoute from "./routers/logRoute";
import livekitRoute from "./routers/livekitRoute";
import smsV1Route from "./routers/smsV1Route";
import videoRoute from "./routers/videoRoute";
import ZapierRoute from "./routers/ZapierRoute";
import cors from "cors";
import { NatsController } from "./controllers/NatsController";
import { initializeDB } from "./config/databaseMongodb";
import helmet from "helmet";
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { AppRateLimit } from "./middlewares/RateLimit";

const webhookEndpoints = new Set(["/api/payment/webhook/payment-status"]);
const rawJsonParser = bodyParser.raw({ type: "application/json" });
const jsonParser = express.json({ limit: "5mb" });
const swaggerDocument = require("../swagger-output.json");

const app = express();

const allowedOrigins = [
    "http://localhost:5173",
    "https://qa.mycountrymobile.com",
    "https://qa.acepeak.com",
    "https://callvisit-qa.mycountrymobile.com",
    "https://ai-dev.mycountrymobile.com",
    "https://ucaas.mycountrymobile.com",
    "https://portal.acepeak.com",
    "https://ai.mycountrymobile.com",
    "https://admin-ucaas.mycountrymobile.com",
];

const corsOptions = {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
        // Mobile and other non-browser clients generally do not send an Origin header.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "org_id",
        "X-Requested-With",
        "X-CSRF-Token",
    ],
};

// app.use(cors(corsOptions));

const accessLogStream = fs.createWriteStream("logs/api.log", { flags: "a" });

const customFormat =
    ":method :url :status :response-time ms :res[content-length]";

app.use(morgan(customFormat, { stream: accessLogStream }));

app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "./", "resources")));
app.use(express.urlencoded({ limit: "5mb", extended: true }));
// app.use(express.json());
app.use((req: any, res, next) => {
    const normalizedPath = String(req.path ?? req.originalUrl ?? "")
        .split("?")[0]
        .replace(/\/+$/, "");

    if (webhookEndpoints.has(normalizedPath)) {
        rawJsonParser(req, res, (err: any) => {
            if (err) return next(err);
            req.rawBody = req.body; // Important: keep it as Buffer
            next();
        });
    } else {
        jsonParser(req, res, next);
    }
});

app.use(helmet()); /** Security headers **/
app.use(mongoSanitize()); /** MongoDB injection protection **/
app.use(hpp()); /** HTTP Parameter Pollution protection **/
app.use(logger);
// app.use(express.static("public"));

// Test connection to database
sequelize
    .authenticate()
    .then(() => {
        console.log("Database connected to MySQL successfully!");
    })
    .catch((err) => {
        console.error("Unable to connect to the MySQL database:", err);
    });

const startServer = async () => {
    try {
        await initializeDB();
    } catch (error) {
        console.error("Unable to initialize MongoDB:", error);
        process.exit(1);
    }

    // Routes

    app.use("/email", express.static(path.join(__dirname, "public/email")));

    app.set("trust proxy", 1);

    app.use((req, res, next) => {
        const normalizedPath = String(req.path ?? req.originalUrl ?? "").split("?")[0].replace(/\/+$/, "");
        const isApiRoute = normalizedPath === "/api" || normalizedPath.startsWith("/api/");
        const isPaymentRoute = normalizedPath === "/api/payment" || normalizedPath.startsWith("/api/payment/");
        /* Exactly the endpoints in the allow-list, not anything with the word
           in its path. `includes("webhook")` exempted /api/<anything>/webhook/x
           from rate limiting, so any route could opt itself out just by being
           named that way. The Set is already declared above and used correctly
           for raw-body parsing; this call site was the one that drifted.

           This was patched directly in the running dist and never made it back
           to source - the third such fix found. Building from source without
           it would have quietly reopened the hole. */
        const isWebhookRoute = webhookEndpoints.has(normalizedPath);

        if (!isApiRoute || isPaymentRoute || isWebhookRoute) {
            return next();
        }

        return AppRateLimit(req, res, next);
    });

    app.use("/api", authRoute);

    app.use("/api/admin", adminRoute);
    app.use("/api/internal", internalRoute);

    app.use("/api/did", didRoute);
    app.use("/api/identity", identityRoute);
    app.use("/api/didw", didWRoute);

    app.use("/api/user", userRoute);
    /* Invite links for new people (own controller: AuthController stays untouched). */
    app.use("/api/invite", inviteRoute);
    app.use("/api/person", personStateRoute);
    /* Who each administrator may act on (helpers/adminScope.ts). */
    app.use("/api/person", adminScopeRoute);

    app.use("/api/site", siteRoute);

    /* Own trusted devices + two-step status, and own five-field profile.
       Both read the caller from the session only. */
    app.use("/api/security/devices", trustedDeviceRoute);
    app.use("/api/profile", profileSelfRoute);
    /* Own company record (name and address), company taken from the session. */
    app.use("/api/company", companySelfRoute);

    app.use("/api/plan", planRoute);

    app.use("/api/payment", paymentRoute);

    app.use("/api/validator", validatorRoute);

    app.use("/api/tenant", tenantRoute);

    app.use("/api/contact", contactRoute);

    app.use("/api/crm", crmRoute);

    app.use("/api/media", mediaRoute);

    app.use("/api/numbers", numberRoute);

    app.use("/api/v1", smsV1Route);

    app.use("/api/fax", faxRoute);

    app.use("/api/company-license", companyLicenseRoute);

    app.use("/api/card", cardRoute);

    app.use("/api/zapier/v1", ZapierRoute);

    app.use("/api/billing", billingRoute);

    app.use("/api/call-queue", callQueueRoute);

    app.use("/api/logs", logRoute);

    app.use("/api/campaign", campaignRoute);

    app.use("/api/calls", campaignRoute);

    app.use("/api/calendar", calendarRoute);

    app.use("/api/video", videoRoute);
    app.use("/api/video-meeting", videoRoute);

    app.use("/api/ai", AiRoute);
    app.use("/api/v2/ai", AiV2Route);
    app.use("/api/livekit", livekitRoute);

    app.use("/api/dnc", dncRoute);
    app.use("/api/global", globalRoute);

    app.use("/api/omni", omniRoute);

    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

    const cronOptions = {
        timezone: "UTC",
        noOverlap: true,
    };

    const registerCronJobs = () => {
        /* Runs every 2 minutes, starting at minute 1 */
        cron.schedule("1-59/2 * * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.checkPlanExpiry();
            await cronHandle.autoRechargeLowBalanceHandler();
            await cronHandle.publishAdminNotificationsCron();
        }, cronOptions);

        /* Runs every 5 minutes, starting at minute 2 */
        cron.schedule("2-59/5 * * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.sendEventTaskReminder();
            // await cronHandle.sendMeetingReminderLegacy();
        }, cronOptions);

        /* Runs every 10 minutes, starting at minute 4 */
        cron.schedule("4-59/10 * * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.notifyStorageLimitSocketCron();
        }, cronOptions);

        /* Runs every 15 minutes, starting at minute 6 */
        cron.schedule("6-59/15 * * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.syncCompanyUsedStorageCron();
            await cronHandle.sendLowBalanceEmailAlertCron();
        }, cronOptions);

        /* Runs hourly at minute 8 */
        cron.schedule("8 * * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.planInactive();
            await cronHandle.releaseInactiveDID();
        }, cronOptions);

        /* Runs once per day at 00:10 UTC */
        cron.schedule("10 0 * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.didPlanRenewalCron();
            await cronHandle.renewPlanCron();
            await cronHandle.azureTtsVoices();
            await cronHandle.renewZohoWebhookSubscriptionsCron();
        }, cronOptions);

        /* Runs once per day at 01:20 UTC */
        cron.schedule("20 1 * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.renewExtraStorageCron();
        }, cronOptions);

        /* Runs once per day at 02:30 UTC */
        cron.schedule("30 2 * * *", async () => {
            const cronHandle = new CronController();
            await cronHandle.cleanupDeletedDIDNumbersCron();
        }, cronOptions);
    };

    const pm2Instance = process.env.NODE_APP_INSTANCE;
    const shouldRunCronJobs = pm2Instance === undefined || pm2Instance === "0";

    if (shouldRunCronJobs) {
        console.log(`Cron jobs registered on PM2 instance ${pm2Instance ?? "local"}.`);
        registerCronJobs();
    } else {
        console.log(`Cron jobs skipped on PM2 instance ${pm2Instance}.`);
    }

    const PORT = process.env.APP_PORT || 3000;

    const server = app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });

    server.setTimeout(3 * 60 * 1000);

    server.on("timeout", (socket) => {
        console.warn("Request timed out!");
        socket.end();
    });
};

startServer();

// async function initializeNats() {
//   if (process.env.ENVIRONMENT === "development" || process.env.ENVIRONMENT === "production") {
//     console.log("===>NatsController (Start)<===");
//     await NatsController.init();
//     console.log("===>NatsController (End)<===");
//   }
// }
// initializeNats();



