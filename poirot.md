# Poirot: Misinformation Detector - Design Updates

## Chain of Thought (CoT) Reasoning Implementation

To improve the accuracy of the misinformation detector, we implemented a Chain of Thought strategy to reduce hallucinations and ensure deeper reasoning before the LLM generates its final verdict.

### 1. Differentiated Instruction Sets
- **Text-based Claims:** `chainOfThoughtInstructions` forces the LLM to explicitly write out its logic ("list entities", "evaluate evidence", "identify fallacies") *before* outputting the final JSON verdict.
- **Image-based Claims:** `oneShotJsonInstructions` bypasses the CoT writing phase and asks for immediate JSON output. This minimizes execution time for complex multimodal images that regularly cause the browser extension to time out if too much text generation processing is required.

### 2. Robust JSON Extraction
- To support the CoT text being written *outside* the JSON block, the target prompt requires the LLM to strictly wrap the final verdict in a markdown codeblock (` ```json ... ``` `).
- The `extractJson` helper (in `helpers.js`) was updated to regex-target the ` ```json ` block specifically. This prevents parsing crashes caused by accidental curly braces `{ }` matching in the LLM's preceding reasoning text.

## Service Worker Timeout Handling (Reverted)

*Note: Attempted to solve Chrome's 30-second Manifest V3 Service Worker timeout using long-lived Ports (`chrome.tabs.connect`), but it caused connection reliability issues on un-refreshed or restricted tabs. The codebase is currently reverted to the standard `fetch` pattern.*