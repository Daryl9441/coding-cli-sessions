import { showHUD } from "@raycast/api";
import { client } from "./ui/client";
export default async function Command() {
  const { removed } = await client.clearDebug();
  await showHUD(`Cleared ${removed} temporary diagnostic files`);
}
