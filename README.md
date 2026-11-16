# ABB Live Interaction

Web app MVP for live event polls and audience Q&A, using Supabase and GitHub Pages.

## Supabase
1. Create a new Supabase project.
2. Run the database SQL provided in the setup guide before using this application.
3. Enable Email authentication.
4. Set the GitHub repository Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. Never use a Supabase secret/service-role key in the browser or in this repository.

## Local development
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev` and open the local URL shown in the terminal.

## GitHub Pages
The workflow in `.github/workflows/deploy.yml` builds and deploys the app when you push to `main`. In repository Settings > Pages select GitHub Actions as the source. Add the two `VITE_...` repository Actions variables under Settings > Secrets and variables > Actions > Variables.

## Capabilities in this version
- Organizer signup/login by email/password.
- Create/edit/delete event and create/edit/delete/reorder questions.
- Single choice, multiple choice, open text and 1–5 rating polls.
- QR code and participant link for each live event.
- Participant submissions with browser-local random pseudonym and estimated response duration.
- Live result refresh through periodic reads.
- Event Q&A, organizer moderation, public approved questions and vote counts.
- Event image upload retaining the original uploaded image; fit/crop/position only affects display.
- Excel export with summary, individual responses, Q&A, and vote totals.
- Event JSON template export/import (does not include response data or image binary).
- Event deletion and image removal attempt after confirming export.

## Important
This is a prototype, not an enterprise-certified service. Browser IDs are not identity verification; timing is client-reported; anonymous public access can be abused. GitHub Pages repositories and built client code are public. Use only the publishable Supabase key in the browser, rely on reviewed RLS rules, and do not process personal, confidential, or sensitive information without ABB IT/Security/Privacy approval. Supabase free-tier limits and service terms apply.
