# Assured Capture

A minimalist, high-reliability field inspection and photo report application designed for inspectors, building surveyors, and field teams. Capture inspection reports, track defect issues, annotate photographic evidence, and synchronize seamlessly across offline IndexedDB and Cloud Firestore.

---

## Features

- **Field Inspection Reports**: Create, manage, and track inspection jobs with structured job references (`BBC-YY-XXXX`), inspection dates, status workflows, and cover photos.
- **Issue & Defect Management**: Organize defects under permanent sequential issue numbers (`#1`, `#2`, ...), with dedicated headlines, descriptions, categories, and internal observation notes.
- **Evidence & Photo Documentation**:
  - Direct camera capture and multi-file gallery selection.
  - Image compression preserving high visual clarity while respecting cloud storage limits.
  - Sequence-ordered evidence gallery with reference image tagging and captions.
- **Canvas Markup & Annotation**: Built-in visual markup tool supporting arrows, freehand drawings, rectangles, circles, custom text callouts, adjustable line weights, and multi-color palettes.
- **Local-First & Resilient Cloud Sync**:
  - Offline-first operations backed by browser IndexedDB.
  - Debounced, coalesced background synchronization queue with hash-based change detection.
  - Manual sync with granular progress reporting, quota backoff protection, and automatic data recovery.
- **DOCX Report Generation**: Instant client-ready Word document (`.docx`) generation including inspector branding, tabular issue breakdowns, and high-resolution annotated evidence photos.
- **Google Drive Integration**: Direct export of generated inspection DOCX reports to Google Drive via client-side OAuth.
- **Multi-Method Authentication**: Secure sign-in with Google OAuth or Email & Password via Firebase Authentication, with guest mode support.

---

## Tech Stack

- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **Styling & UI**: [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/), [Motion](https://motion.dev/)
- **Local Storage**: IndexedDB (`AssuredCaptureDB`)
- **Cloud Backend**: [Firebase Authentication](https://firebase.google.com/docs/auth) & [Cloud Firestore](https://firebase.google.com/docs/firestore)
- **Document Export**: [`docx`](https://docx.js.org/) & [`file-saver`](https://github.com/eligrey/FileSaver.js/)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- `npm` or `bun`

### Installation

1. Clone or extract the repository:
   ```bash
   git clone <repository-url>
   cd assured-capture
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Start the local development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Available Scripts

- `npm run dev` — Starts the Vite development server on `http://0.0.0.0:3000`.
- `npm run build` — Type-checks and compiles the production bundle into `dist/`.
- `npm run preview` — Locally previews the production build.
- `npm run lint` — Validates TypeScript types across the entire codebase (`tsc --noEmit`).

---

## Configuration & Security

- **Firebase Configuration**: Cloud credentials are configured in `firebase-applet-config.json`.
- **Firestore Security Rules**: Database rules enforcing user data isolation and parent-child report ownership are specified in `firestore.rules`.
- **Database Schema**: Entity schema specifications and subcollection structures are documented in `firebase-blueprint.json`.

---

## License

Private / Proprietary. All rights reserved.
