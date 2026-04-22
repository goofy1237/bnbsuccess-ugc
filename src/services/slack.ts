import { config } from "../config/env.js";

interface SlackMessage {
  text: string;
  blocks?: unknown[];
  channel?: string;
}

/**
 * Send a notification to Slack via webhook.
 */
export async function sendSlackNotification(
  message: SlackMessage
): Promise<void> {
  if (!config.slackWebhookUrl) {
    console.warn("[Slack] No webhook URL configured, skipping notification");
    return;
  }

  const response = await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: message.text,
      channel: message.channel || config.slackChannel,
      blocks: message.blocks,
    }),
  });

  if (!response.ok) {
    console.error(`[Slack] Notification failed: ${response.status}`);
  }
}

/**
 * Notify that scripts are ready for approval.
 */
export async function notifyScriptsReady(
  scripts: Array<{ id: string; angle: string; hook_type: string }>
): Promise<void> {
  const scriptList = scripts
    .map((s) => `- *${s.angle}* (${s.hook_type}) — ID: \`${s.id}\``)
    .join("\n");

  await sendSlackNotification({
    text: `New scripts ready for approval:\n${scriptList}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "New UGC Scripts Ready for Review",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: scriptList,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Reply with script IDs to approve, or edit in Supabase dashboard.",
          },
        ],
      },
    ],
  });
}

/**
 * Notify that a finished ad is ready.
 */
export async function notifyAdComplete(
  adId: string,
  fileUrl: string,
  metadata: { angle: string; duration: number; aspectRatio: string }
): Promise<void> {
  await sendSlackNotification({
    text: `Finished ad ready: ${metadata.angle} (${metadata.duration}s, ${metadata.aspectRatio})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New Ad Creative Complete" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Angle:* ${metadata.angle}\n*Duration:* ${metadata.duration}s\n*Format:* ${metadata.aspectRatio}\n*ID:* \`${adId}\``,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${fileUrl}|Download Video>`,
        },
      },
    ],
  });
}

/**
 * Notify pipeline error.
 */
export async function notifyPipelineError(
  stage: string,
  error: string,
  scriptId?: string
): Promise<void> {
  await sendSlackNotification({
    text: `Pipeline error at ${stage}: ${error}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Pipeline Error: ${stage}` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Stage:* ${stage}\n*Error:* ${error}${scriptId ? `\n*Script ID:* \`${scriptId}\`` : ""}`,
        },
      },
    ],
  });
}
