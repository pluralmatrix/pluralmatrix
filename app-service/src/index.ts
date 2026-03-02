import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { startMatrixBot } from './bot';
import routes from './routes';
import gatekeeperRoutes from './routes/gatekeeperRoutes';
import * as gatekeeperController from './controllers/gatekeeperController';
import { messageQueue } from './services/queue/MessageQueue';

const app = express();
const PORT = process.env.APP_PORT || 9000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Request Logger
app.use((req, res, next) => {
    const url = req.url.split('?')[0];
    console.log(`[API] ${req.method} ${url}`);
    next();
});

// Serve static files from the React app
const clientPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientPath));

// API Routes
app.use('/api', routes);

// Healthcheck (Unauthenticated)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Check for mandatory environment variables
if (!process.env.AS_TOKEN || !process.env.JWT_SECRET) {
    console.error('FATAL: Missing mandatory environment variables AS_TOKEN or JWT_SECRET!');
    process.exit(1);
}

// Synapse Gatekeeper Compatibility (Module expects /check at root)
app.post('/check', gatekeeperController.checkMessage);

// All other requests will return the React app
app.use((req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

if (require.main === module) {
    startMatrixBot().then(async () => {
        app.listen(PORT, () => {
            console.log(`App Service (Brain) listening on port ${PORT}`);
        });

        // --- INTERNAL GATEKEEPER PORT (Port 9001) ---
        // This port is NOT exposed in docker-compose.yml and is only 
        // accessible to Synapse within the Docker network.
        const internalApp = express();
        internalApp.use(bodyParser.json({ limit: '5mb' }));
        // Bypass the router and mount the controller function directly
        internalApp.post('/check', gatekeeperController.checkMessage); 
        
        internalApp.listen(9001, '0.0.0.0', () => {
            console.log(`Internal Gatekeeper listening on port 9001 (Docker-only)`);
        });
    }).catch(err => {
        console.error("Failed to start Matrix Bot:", err);
        process.exit(1);
    });
}

export { app };
