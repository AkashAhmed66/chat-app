import { pool } from "./db";

export async function areFriends(a: string, b: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [a, b]
  );
  return (rowCount ?? 0) > 0;
}
