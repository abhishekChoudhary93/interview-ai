**Welcome to your Base44 project** 

**About**

View and Edit  your app on [Base44.com](http://Base44.com) 

This project contains everything you need to run your app locally.

**Edit the code in your local development environment**

Any change pushed to the repo will also be reflected in the Base44 Builder.

**Prerequisites:** 

1. Clone the repository using the project's Git URL 
2. Navigate to the project directory
3. Install dependencies: `npm install`
4. Create an `.env.local` file (see [.env.example](.env.example)) and set variables for either **mock** or **real** Base44.

**Option A — Local mock (full UI, no Base44 login)**

Use this to run the interview flow entirely in the browser with canned “LLM” responses and in-memory interviews.

```
VITE_USE_MOCK_BASE44=true
```

Data is cleared when you refresh the page. Logout and “login” are no-ops in mock mode.

On each load, mock mode seeds **three completed interviews** (see [src/api/mockInterviewSeed.js](src/api/mockInterviewSeed.js)) so **Dashboard** and **History** are populated and you can open full **Reports**—including one **video** session with eye-contact and body-language scores. New interviews you create are merged with that seed until you refresh.

**Option B — Real Base44 backend**

Unset `VITE_USE_MOCK_BASE44` or set it to `false`, then set your app credentials from the Base44 dashboard:

```
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url

e.g.
VITE_BASE44_APP_ID=cbef744a8545c389ef439ea6
VITE_BASE44_APP_BASE_URL=https://my-to-do-list-81bfaad7.base44.app
```

Run the app: `npm run dev`

**Publish your changes**

Open [Base44.com](http://Base44.com) and click on Publish.

**Docs & Support**

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Support: [https://app.base44.com/support](https://app.base44.com/support)
