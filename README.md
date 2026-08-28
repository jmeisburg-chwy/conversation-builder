# Conversation Builder

A standalone Chewy ChatGPT Site for creating Articulate Rise Conversation Simulator JSON files.

## What works

1. Start a new learning-objective scenario, improve a compatible JSON file, or create a separate learning-objective copy from existing JSON.
2. Generate a guarded first draft with Coach Chewy, then review and edit the setup, partner behavior, response flow, guidance, and objectives.
3. Validate and download separate chat and voice files for manual testing in Articulate Rise.

Drafts stay only in the open browser tab. This Site does not publish scenarios, write to AWS, or keep a server-side draft library.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure `OPENAI_API_KEY` only in the server environment. Do not put it in client code, commit it, or paste it into a support message. `OPENAI_AUTHORING_MODEL` is optional.

## Verification

```bash
npm test
npm run lint
npm run build
```

The generated contract follows the Customer Simulator Scenario Factory rules: learning-objective evaluation only, one channel per file, matching channel suffixes, no legacy behavior rubric, chat progression mirrored in `chatConfig`, and required voice configuration.

## Release gate

Do not deploy until both are true:

1. An approved pilot OpenAI credential is configured as the server-side `OPENAI_API_KEY` secret.
2. The Site access policy is set to the Chewy workspace.

Deployment does not replace manual Rise testing or publish JSON to the shared scenario library.
