import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Detail,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { isTerminal } from "./core/state-machine";
import { Task } from "./core/types";
import { client } from "./ui/client";
import { TaskForm } from "./ui/task-form";
import { useSessions } from "./ui/use-sessions";
import { fencedText } from "./core/privacy";

const stateColor: Record<Task["state"], Color> = {
  starting: Color.Yellow,
  running: Color.Green,
  stopping: Color.Orange,
  completed: Color.Blue,
  failed: Color.Red,
  cancelled: Color.SecondaryText,
  "timed-out": Color.Orange,
  interrupted: Color.Red,
};

async function stop(id: string) {
  if (
    !(await confirmAlert({
      title: "Stop this task?",
      message:
        "The managed CLI process and its child process group will receive a termination signal. Existing file changes remain.",
      primaryAction: { title: "Stop Task", style: Alert.ActionStyle.Destructive },
    }))
  )
    return;
  try {
    await client.stop(id);
    await showToast({ style: Toast.Style.Success, title: "Stopping task" });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Unable to stop task",
      message: error instanceof Error ? error.message : undefined,
    });
  }
}

function TaskActions({ task }: { task: Task }) {
  return (
    <ActionPanel>
      <Action.Push title="View Live Progress" icon={Icon.Text} target={<TaskDetail id={task.id} />} />
      {!isTerminal(task.state) && (
        <Action title="Stop Task" icon={Icon.Stop} style={Action.Style.Destructive} onAction={() => stop(task.id)} />
      )}
      {isTerminal(task.state) && task.persistSession && task.sessionId && (
        <Action.Push
          title="Resume Session"
          icon={Icon.Play}
          target={<TaskForm engine={task.engine} cwd={task.cwd} resume={task.sessionId} />}
        />
      )}
      <Action.Push
        title="Start Another Task"
        icon={Icon.Plus}
        target={<TaskForm engine={task.engine} cwd={task.cwd} />}
      />
      {isTerminal(task.state) && (
        <Action title="Clear Result from Memory" icon={Icon.Trash} onAction={() => client.forget(task.id)} />
      )}
    </ActionPanel>
  );
}

function TaskDetail({ id }: { id: string }) {
  const { data, isLoading } = useSessions();
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return <Detail isLoading={isLoading} markdown="This task is no longer in supervisor memory." />;
  const body = task.events
    .map((event) => `**${new Date(event.at).toLocaleTimeString()} · ${event.kind}**\n\n${fencedText(event.text)}`)
    .join("\n\n---\n\n");
  return (
    <Detail
      navigationTitle={`${task.engine === "claude" ? "Claude Code" : "Codex"} · ${task.state}`}
      markdown={body || "Waiting for the first structured event…"}
      actions={<TaskActions task={task} />}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="State" text={task.state} />
          <Detail.Metadata.Label title="Project" text={task.cwd} />
          <Detail.Metadata.Label title="Policy" text={task.policy} />
          <Detail.Metadata.Label
            title="Session History"
            text={task.persistSession ? "CLI persistence enabled" : "Not saved"}
          />
          <Detail.Metadata.Label title="Session ID" text={task.sessionId || "Awaiting CLI initialization"} />
        </Detail.Metadata>
      }
    />
  );
}

function ObservedDetail({ engine, id }: { engine: Task["engine"]; id: string }) {
  const { data, error, isLoading } = useSessions();
  const item = data.observed.find((session) => session.id === id && session.engine === engine);
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="Observed Session"
      markdown={
        item
          ? `## ${engine === "claude" ? "Claude Code" : "Codex"}\n\n${item.summary}\n\nActivity: **${item.activity}**\n\nLast change: ${new Date(item.updatedAt).toLocaleString()}\n\nThis session is observed from a local transcript. External processes cannot be stopped or approved by this extension. Resume only after the original session has stopped.`
          : error || "This session is no longer available in the local transcript index."
      }
    />
  );
}

export default function Command() {
  const { data, error, isLoading } = useSessions();
  const managed = new Set(data.tasks.map((task) => `${task.engine}:${task.sessionId}`));
  const observed = data.observed.filter((item) => !managed.has(`${item.engine}:${item.id}`));
  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search local sessions by CLI, project, or state"
      actions={
        <ActionPanel>
          <Action.Push title="Start Coding Task" icon={Icon.Plus} target={<TaskForm />} />
          <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    >
      {error && (
        <List.Item
          icon={Icon.Warning}
          title="Local supervisor unavailable"
          subtitle={error}
          actions={
            <ActionPanel>
              <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      )}
      <List.Section
        title="Managed Tasks"
        subtitle={`${data.tasks.filter((task) => !isTerminal(task.state)).length} running · results in memory`}
      >
        {data.tasks.map((task) => (
          <List.Item
            key={task.id}
            icon={{ source: Icon.Terminal, tintColor: stateColor[task.state] }}
            title={task.engine === "claude" ? "Claude Code" : "Codex"}
            subtitle={task.cwd}
            keywords={[task.state, task.sessionId || ""]}
            accessories={[
              { tag: { value: task.state, color: stateColor[task.state] } },
              { date: new Date(task.updatedAt) },
            ]}
            actions={<TaskActions task={task} />}
          />
        ))}
      </List.Section>
      <List.Section title="Observed CLI History" subtitle="Read only · recent activity does not prove process liveness">
        {observed.map((item) => (
          <List.Item
            key={`${item.engine}:${item.id}`}
            icon={Icon.Eye}
            title={`${item.engine === "claude" ? "Claude Code" : "Codex"} · ${item.id.slice(0, 8)}`}
            subtitle={item.cwd || "Project not recorded"}
            keywords={[item.summary, item.activity]}
            accessories={[{ tag: item.activity }, { date: new Date(item.updatedAt) }]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Inspect Observed Session"
                  icon={Icon.Eye}
                  target={<ObservedDetail engine={item.engine} id={item.id} />}
                />
                {item.cwd && item.activity !== "unavailable" && (
                  <Action.Push
                    title="Resume After Original Task Stops"
                    icon={Icon.Play}
                    target={<TaskForm engine={item.engine} cwd={item.cwd} resume={item.id} />}
                  />
                )}
                <Action.CopyToClipboard title="Copy Session ID" content={item.id} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {!error && data.tasks.length === 0 && observed.length === 0 && (
        <List.EmptyView
          icon={Icon.Terminal}
          title="Your coding sessions, in one place"
          description="Start a task or open Check Coding CLI Setup. Existing local CLI logs appear automatically."
        />
      )}
    </List>
  );
}
