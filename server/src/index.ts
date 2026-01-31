import express from 'express';
import './env';
import { analyzeRouter } from './analyzeRoute';

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use('/api', analyzeRouter);

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
