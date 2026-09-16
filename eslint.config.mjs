import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([...next,...ts,{rules:{'@typescript-eslint/no-explicit-any':'off','react-hooks/set-state-in-effect':'off','react-hooks/exhaustive-deps':'off','@next/next/no-img-element':'off'}},globalIgnores(['.next/**','node_modules/**'])]);
