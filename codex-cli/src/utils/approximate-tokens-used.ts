import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

/**
 * Roughly estimate the number of language‑model tokens represented by a list
 * of OpenAI `ResponseItem`s.
 *
 * A full tokenizer would be more accurate, but would add a heavyweight
 * dependency for only marginal benefit. Empirically, assuming ~4 characters
 * per token offers a good enough signal for displaying context‑window usage
 * to the user.
 *
 * The algorithm counts characters from the different content types we may
 * encounter and then converts that char count to tokens by dividing by four
 * and rounding up.
 */
export function approximateTokensUsed(
  items: Array<ChatCompletionMessageParam>,
): number {
  let charCount = 0;

  for (const item of items) {
    switch (item.type) {
      case "message": {
        if (item.role !== "user" && item.role !== "assistant") {
          continue;
        }

        for (const c of item.content) {
          if (c.type === "input_text" || c.type === "output_text") {
            charCount += c.text.length;
          } else if (c.type === "refusal") {
            charCount += c.refusal.length;
          } else if (c.type === "input_file") {
            charCount += c.filename?.length ?? 0;
          }
          // images and other content types are ignored (0 chars)
        }
        break;
      }
      default:
        // Handle other types or ignore
        break;
    }
    if ("tool_calls" in item && item.tool_calls) {
      for (const toolCall of item.tool_calls) {
        charCount += toolCall.function.name.length;
        charCount += toolCall.function.arguments.length;
      }
    }
  }

  return Math.ceil(charCount / 4);
}
