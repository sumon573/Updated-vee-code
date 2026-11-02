/**
 * /profile/menu — ChatGPT premium profile menu page.
 *
 * 2026-11-02 (boss): opened from the Room-header person icon (trophy |
 * person | search). The Me tab keeps the old profile page unchanged.
 * Back returns to wherever it was opened from (router stack).
 */
import ProfileMenuHost from '@/src/features/profile/ProfileMenuHost';

export default function ProfileMenuPage() {
  return <ProfileMenuHost />;
}
