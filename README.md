# EduTubers

**Turn passive content into active learning.**

EduTubers transforms videos, transcripts, articles, and notes into editable interactive mini-courses — with flashcards, quizzes, practice tasks, analytics, and export options. Powered by OpenAI.

---

## Tech Stack

| Technology | Role |
|------------|------|
| **Next.js 15** (App Router) | React framework — routing, SSR, API routes |
| **Node.js** | Runtime for Next.js API routes (server-side OpenAI calls) |
| **React 19** | UI component library |
| **TypeScript** | Type safety across the full app |
| **Tailwind CSS v4** | Utility-first styling |
| **OpenAI API** | GPT-5.x course generation (called server-side via API route) |
| **localStorage** | Client-side data persistence — no database needed |

> **No Python required.** Node.js API routes handle all server-side logic including the OpenAI call. The API key is never exposed to the browser.

---

## Architecture

```
Browser (React)
    │
    │  POST /api/generate  (with content + key)
    ▼
Next.js API Route  ──►  OpenAI API
(Node.js server)         (GPT-5.x)
    │
    ▼
Returns structured Course JSON
    │
    ▼
Browser saves to localStorage
```

The OpenAI API key travels only from the browser to the Next.js server — it is **never bundled in client code**.

---

## Pages

| Route | Page |
|-------|------|
| `/` | Landing page |
| `/generate` | Course Generator |
| `/dashboard` | Creator Dashboard |
| `/editor/[id]` | Course Editor |
| `/editor/[id]/module/[moduleId]` | Module Editor |
| `/analytics/[id]` | Analytics |
| `/export/[id]` | Export & Publish |
| `/course/[id]` | Public Course Overview |
| `/course/[id]/module/[moduleId]` | Public Module (lesson, flashcards, quiz, tasks) |
| `/course/[id]/feedback` | Feedback & Reviews |

---

## Getting Started

### Prerequisites
- Node.js 18+
- An OpenAI API key (get one free at [platform.openai.com](https://platform.openai.com))

### Install & Run

```bash
cd EduTubers
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build for production

```bash
npm run build
npm start
```

### API Key

Paste your OpenAI key in the **Course Generator** page. It's stored in your browser's `localStorage` and sent only to the Next.js API route — never to any third-party server.

---

## How IBM Bob Was Used

**IBM Bob** designed and built the entire application:

1. **Architecture** — Designed the Next.js App Router structure, Node.js API route for server-side OpenAI calls, and localStorage data layer
2. **API Route** — Built the `/api/generate` Node.js endpoint that takes transcript + options, calls OpenAI GPT-5.x, hydrates IDs, and returns a structured Course object
3. **All pages** — Landing, Generator, Dashboard, Editor, Module Editor, Public Course, Public Module (with colourful flashcards/quiz/tasks), Feedback, Analytics, Export
4. **AI Prompt Engineering** — Wrote the detailed prompt that instructs the AI to base all content on the actual transcript, not generic placeholders
5. **Tech migration** — Migrated from Vite/React SPA to Next.js 15 with full App Router structure
6. **README** — Authored this file

---

## Made with IBM Bob
