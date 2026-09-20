# 🌐 Step-by-Step Guide: How to Make Your App Live at `https://your-name.com`

This guide explains how to publish your **Daily Expense Tracker** to the internet with a real `https://` web address and connect your own custom domain (e.g. `https://myexpensetracker.com`).

---

## ⚡ STEP 1: Deploy to Free Cloud Hosting (5 Minutes)

You can host this app 100% free on **[Render.com](https://render.com)** (which provides automatic 24/7 background servers, database persistence, and free `https://` SSL security).

### Method A: Via GitHub (Recommended)
1. Initialize git and push this `daily-expense-tracker` folder to a repository on [GitHub.com](https://github.com):
   ```bash
   cd daily-expense-tracker
   git init
   git add .
   git commit -m "Initial commit of SpendWise app"
   git remote add origin https://github.com/YOUR_USERNAME/spendwise-tracker.git
   git branch -M main
   git push -u origin main
   ```
2. Go to **[Render.com](https://render.com)** and sign up (Free).
3. Click **New +** &rarr; **Web Service**.
4. Connect your GitHub repository.
5. Enter the following settings:
   - **Name**: `spendwise-tracker` (or any name you choose)
   - **Region**: Choose closest to you (e.g. Singapore or Frankfurt)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
6. Click **Create Web Service**.
7. Render will build and deploy your app. In 2 minutes, you will get your live public URL:
   👉 **`https://spendwise-tracker.onrender.com`**

---

## 🏷️ STEP 2: Connect Your Custom Domain (`https://yourname.com`)

If you want a custom link like `https://myexpensetracker.com`:

1. **Buy a Domain**:
   - Buy your domain on [Namecheap.com](https://www.namecheap.com), [GoDaddy.com](https://www.godaddy.com), or [Hostinger.com](https://www.hostinger.com) (prices start around ₹499 / $5-$9 per year).
2. **Add Domain to Render**:
   - In your Render Web Service dashboard, go to **Settings** &rarr; **Custom Domains**.
   - Click **Add Custom Domain** and enter `yourname.com` (and `www.yourname.com`).
3. **Update DNS Records in Your Domain Provider**:
   - In GoDaddy / Namecheap DNS settings, add:
     - **CNAME Record**: Name: `www`, Value: `your-app-name.onrender.com`
     - **A Record**: Name: `@`, Value: `216.24.57.1` (Render's IP)
4. Render will automatically generate a **free SSL certificate** (`https://`).
5. Your app is now live at:
   👉 **`https://yourname.com`**

---

## 🔍 STEP 3: Indexing on Google Search

Once your custom domain is live:
1. Open [Google Search Console](https://search.google.com/search-console).
2. Click **Add Property** and enter `https://yourname.com`.
3. Verify ownership (via DNS TXT record or HTML tag).
4. Submit your sitemap: `https://yourname.com/sitemap.xml`.
5. Google will start crawling and indexing your site so anyone searching on Google can find it!
