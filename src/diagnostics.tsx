import { Action, ActionPanel, Detail, openExtensionPreferences } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { client } from "./ui/client";

export default function Command() {
  const { data, isLoading, revalidate } = usePromise(async () =>
    Promise.all([client.inspect("claude"), client.inspect("codex")]),
  );
  const markdown =
    data
      ?.map(
        (cap) =>
          `## ${cap.engine === "claude" ? "Claude Code" : "Codex"}\n\n- Version: ${cap.version}\n- Executable: \`${cap.executable}\`\n- Login verified by CLI: **${cap.loggedIn ? "Yes" : "No"}**\n- Required flags: **${cap.compatible ? "Available" : "Incompatible"}**\n${cap.issues.map((issue) => `- ${issue}`).join("\n")}\n`,
      )
      .join("\n---\n\n") || "Checking installed CLI executables and official login-status commands…";
  return (
    <Detail
      isLoading={isLoading}
      markdown={
        markdown + "\n\nNo credential files are opened by this extension. No model requests are made by diagnostics."
      }
      actions={
        <ActionPanel>
          <Action title="Check Again" onAction={revalidate} />
          <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
