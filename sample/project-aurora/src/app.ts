import { createServer } from "./server";
import { setupCollaboration } from "./collaboration";
import { setupRoutes } from "./routes";

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    const server = createServer();
    const collaboration = setupCollaboration(server);
    const routes = setupRoutes(app);

    server.listen(PORT, () => {
      console.log(`🚀 Collaboration server running on port ${PORT}`);
      console.log(`✨ Ready for teamwork!`);
    });

    // Notify connected clients
    collaboration.on("user-joined", (user) => {
      console.log(`${user.name} joined the session`);
    });

    collaboration.on("code-change", (data) => {
      console.log(`Code updated by ${data.userName}`);
    });

  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

start();
