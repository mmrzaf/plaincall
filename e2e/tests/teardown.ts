import { deleteTestRooms } from './helpers';

export default async function teardown(): Promise<void> {
  const deleted = await deleteTestRooms();
  console.log(`Deleted ${deleted} e2e- room(s) from LiveKit.`);
}
