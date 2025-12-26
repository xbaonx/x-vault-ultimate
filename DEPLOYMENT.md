# Deployment Guide

## 1. GitHub Actions (CI)

The project includes a GitHub Actions workflow `.github/workflows/ci.yml` that automatically builds all workspaces on every push to the `main` branch.

To enable this:
1. Push this repository to GitHub.
2. The workflow will run automatically.

## 2. Render.com (CD)

The project is configured for deployment on [Render.com](https://render.com) using Infrastructure as Code (Blueprint).

### Prerequisites
- A Render.com account.
- This repository connected to your Render account.

### Setup
1. Go to the Render Dashboard.
2. Click **New +** -> **Blueprint**.
3. Connect your repository.
4. Render will detect `render.yaml` and propose the services to be created:
   - `x-vault-backend` (Web Service)
   - `x-vault-web` (Static Site)
   - `x-vault-admin` (Static Site)
5. Review the plan and click **Apply**.

### Environment Variables
The `render.yaml` sets default environment variables. You may need to update them in the Render Dashboard for production:

**Backend:**
- `NODE_ENV`: `production`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`: Your PostgreSQL database credentials (you can create a PostgreSQL database on Render and link it).
- `RPC_URL`: Your blockchain RPC URL (e.g., Alchemy, Infura).
- `BUNDLER_URL`: Your ERC-4337 Bundler URL (e.g., Stackup, Pimlico).
- `PAYMASTER_SIGNING_KEY`: Private key for the Paymaster signer.
- `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_ID`: Apple Wallet credentials.
- `APPLE_SIGNER_CERT`, `APPLE_SIGNER_KEY`, `APPLE_WWDR_CERT`: Paths or content for Apple certificates. Note: For production, consider using a secure secret manager or encoding these files as base64 env vars and decoding them at runtime.

## 3. Local Development

To run the project locally:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build all packages:**
   ```bash
   npm run build:all
   ```

3. **Run services:**
   - **Backend:** `npm run dev:backend` (Port 3000)
   - **Web App:** `npm run dev:web` (Port 5173)
   - **Admin Dashboard:** `npm run dev:admin` (Port 5174)
