import {createVercelHandler} from '../backend/vercel/handler.js';
const fetch = createVercelHandler(process.env);
export default {fetch};
