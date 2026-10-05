/**
 * Gift catalog for DISPLAY ONLY.
 *
 * Coin costs are server-authoritative (api-server `GIFT_CATALOG`): the web
 * client sends only `giftId` to POST /api/wallet/send-gift and never trusts
 * these amounts for charging. This list mirrors the server catalog so the
 * UI can show names/prices; if the server ever changes a price, the charge
 * follows the server, not this file.
 */

export type GiftItem = {
  id: string;
  emoji: string;
  name: string;
  coins: number;
};

export const GIFT_CATALOG: GiftItem[] = [
  { id: '1', emoji: '💝', name: 'Heart', coins: 10 },
  { id: '2', emoji: '🌹', name: 'Rose', coins: 25 },
  { id: '3', emoji: '🎁', name: 'Gift', coins: 50 },
  { id: '4', emoji: '💎', name: 'Diamond', coins: 100 },
  { id: '5', emoji: '🏆', name: 'Trophy', coins: 200 },
  { id: '6', emoji: '🚀', name: 'Rocket', coins: 500 },
  { id: '7', emoji: '👑', name: 'Crown', coins: 1000 },
  { id: '8', emoji: '🎆', name: 'Fireworks', coins: 2000 },
];

export function giftById(id: string): GiftItem | undefined {
  return GIFT_CATALOG.find((g) => g.id === id);
}
