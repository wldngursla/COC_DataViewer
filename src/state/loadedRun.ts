/**
 * The single parsed run shared by every analysis page. Owned by App state and
 * passed down as a prop — parse once, view anywhere, no re-parsing on tab
 * switches.
 */

import type { ParsedLog } from '../parser/types';

export interface LoadedRun {
  fileName: string;
  fileSize: number;
  result: ParsedLog;
}
