import { startServer } from "./server";
import { socketPath } from "./paths";

const passed = process.argv[process.argv.indexOf("--socket") + 1];
if (passed !== socketPath()) process.exitCode = 1;
else {
  void startServer(passed)
    .then(({ close }) => {
      process.once("SIGTERM", () => {
        void close();
      });
      process.once("SIGINT", () => {
        void close();
      });
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
