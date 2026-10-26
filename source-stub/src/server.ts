import { port, serve } from '../../shared/runtime.js';
import { createSourceStub } from './app.js';

serve(createSourceStub().app, port(process.env.SOURCE_PORT, 3002), 'Source stub');
