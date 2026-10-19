import { DeletionScreen } from '@/features/deletion/deletion-screen';

// Thin route wrapper: the screen lives in src/features/deletion/deletion-screen.tsx.
// Params: scope=child|account, child=<child id> (optional).
export default function DeleteData() {
  return <DeletionScreen />;
}
