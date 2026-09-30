import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const distPath = path.join(__dirname, 'dist');

// Serve static assets from built distribution directory if present
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Fallback SPA router for client side navigation
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('Assured Capture field inspection service active.');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Assured Capture server listening on 0.0.0.0:${PORT}`);
});
