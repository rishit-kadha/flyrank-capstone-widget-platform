import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
const app = express();
app.use(express.static(fileURLToPath(new URL('../customer/', import.meta.url))));
app.listen(Number(process.env.CUSTOMER_PORT || 5500), () => console.log('Customer site ready on http://localhost:' + (process.env.CUSTOMER_PORT || 5500)));
