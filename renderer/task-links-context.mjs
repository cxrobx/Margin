import { createContext } from 'react';

// Task integration starts disabled until the user opts in and CXTasks is found.
export const TaskLinksContext = createContext(false);
// Document chips appear only when Onyx is installed; otherwise links read as before.
export const DocumentChipsContext = createContext(false);
// Board chips appear only when CXBoards is installed; no opt-in, like documents.
export const BoardChipsContext = createContext(false);
