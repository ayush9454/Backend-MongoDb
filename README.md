# Smart Parking Backend

## Vercel Deployment

This backend is now structured for deployment on Vercel as serverless functions. Each API route is a separate file in the `api/` directory.

### Steps to Deploy

1. Push this backend to a GitHub repository.
2. Go to [vercel.com](https://vercel.com/) and import your repository.
3. Set the environment variable `MONGO_URI` in the Vercel dashboard (Project Settings > Environment Variables).
4. Deploy!

### After Deployment
- Note your Vercel backend URL (e.g., `https://your-backend.vercel.app/api`).
- Update the frontend's `API_BASE_URL` in `frontend/src/services/api.ts` to point to your new backend URL.

---

## Local Development

You can still run the original Express server locally using `server.js` if needed:

```bash
npm install
npm run dev
```

But for Vercel, use the serverless functions in the `api/` directory. 