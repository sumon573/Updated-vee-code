/**
 * 2026-10-16 (Sumon): Universal content renderer — displays server-driven content anywhere.
 * 
 * Usage in any screen:
 *   <UniversalContentRenderer location="home" />
 *   <UniversalContentRenderer location="voice_room" />
 * 
 * Automatically fetches from server, filters by location/targeting/timing,
 * and renders based on contentType (banner/popup/fullscreen/floating/announcement).
 */

import React, { useState, useEffect } from 'react';
import { View, Text, Image, Pressable, Modal, StyleSheet, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  getContentForLocation, 
  subscribeAppContent,
  AppContent 
} from '@/src/services/appContentService';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface Props {
  location: string;
  uid?: string;
  userLevel?: number;
  nobleRank?: string;
  onAction?: (content: AppContent) => void;
}

/**
 * Check and increment show counter for maxShows enforcement.
 */
async function shouldShowContent(content: AppContent): Promise<boolean> {
  if (!content.maxShows || content.maxShows <= 0) return true;
  
  const key = `content_shows:${content.id}`;
  try {
    const countStr = await AsyncStorage.getItem(key);
    const count = countStr ? parseInt(countStr, 10) : 0;
    return count < content.maxShows;
  } catch {
    return true;
  }
}

async function recordContentShown(content: AppContent): Promise<void> {
  if (!content.maxShows || content.maxShows <= 0) return;
  
  const key = `content_shows:${content.id}`;
  try {
    const countStr = await AsyncStorage.getItem(key);
    const count = countStr ? parseInt(countStr, 10) : 0;
    await AsyncStorage.setItem(key, String(count + 1));
  } catch {
    // Non-critical
  }
}

export function UniversalContentRenderer({ location, uid, userLevel, nobleRank, onAction }: Props) {
  const [contents, setContents] = useState<AppContent[]>([]);
  const [dismissedPopups, setDismissedPopups] = useState<Set<string>>(new Set());

  useEffect(() => {
    let unsub: (() => void) | null = null;
    
    const load = async () => {
      const items = await getContentForLocation(location, uid, userLevel, nobleRank);
      // Filter by maxShows
      const filtered: AppContent[] = [];
      for (const item of items) {
        if (await shouldShowContent(item)) {
          filtered.push(item);
        }
      }
      setContents(filtered);
      // Record shown
      filtered.forEach(item => recordContentShown(item));
    };
    
    load();
    unsub = subscribeAppContent(() => load());
    
    return () => { if (unsub) unsub(); };
  }, [location, uid]);

  const handlePress = (content: AppContent) => {
    if (onAction) {
      onAction(content);
    } else if (content.actionType === 'open_url' && content.actionUrl) {
      // Default: open URL (implement with Linking)
      console.log('[UniversalContent] Open URL:', content.actionUrl);
    }
  };

  const dismissPopup = (id: string) => {
    setDismissedPopups(prev => new Set(prev).add(id));
  };

  // Group by content type
  const banners = contents.filter(c => c.contentType === 'banner');
  const popups = contents.filter(c => c.contentType === 'popup' && !dismissedPopups.has(c.id));
  const announcements = contents.filter(c => c.contentType === 'announcement');
  const floating = contents.filter(c => c.contentType === 'floating');

  return (
    <View style={{ zIndex: 999 }}>
      {/* Announcement bars (top) */}
      {announcements.map(item => (
        <Pressable key={item.id} onPress={() => handlePress(item)}
          style={styles.announcement}>
          <Text style={styles.announcementText} numberOfLines={1}>
            📢 {item.title}
          </Text>
        </Pressable>
      ))}

      {/* Banners */}
      {banners.map(item => (
        <Pressable key={item.id} onPress={() => handlePress(item)}
          style={[styles.banner, item.position === 'bottom' && styles.bannerBottom]}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.bannerImage} resizeMode="cover" />
          ) : (
            <View style={styles.bannerFallback}>
              <Text style={styles.bannerTitle}>{item.title}</Text>
              {item.description && (
                <Text style={styles.bannerDesc} numberOfLines={2}>{item.description}</Text>
              )}
            </View>
          )}
        </Pressable>
      ))}

      {/* Floating widgets */}
      {floating.map(item => (
        <Pressable key={item.id} onPress={() => handlePress(item)}
          style={[styles.floating, item.position === 'bottom' ? { bottom: 100 } : { top: 100 }]}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.floatingImage} />
          ) : (
            <View style={styles.floatingFallback}>
              <Text style={styles.floatingText}>{item.title}</Text>
            </View>
          )}
        </Pressable>
      ))}

      {/* Popups (modal) */}
      {popups.map(item => (
        <Modal key={item.id} visible transparent animationType="fade"
          onRequestClose={() => dismissPopup(item.id)}>
          <Pressable style={styles.popupOverlay} onPress={() => dismissPopup(item.id)}>
            <Pressable style={styles.popupContent} onPress={() => handlePress(item)}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.popupImage} resizeMode="cover" />
              ) : null}
              <View style={styles.popupBody}>
                <Text style={styles.popupTitle}>{item.title}</Text>
                {item.description && (
                  <Text style={styles.popupDesc}>{item.description}</Text>
                )}
                <Pressable style={styles.popupClose} onPress={() => dismissPopup(item.id)}>
                  <Text style={styles.popupCloseText}>✕</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  announcement: {
    backgroundColor: '#FF6B35',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  announcementText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  banner: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerBottom: {
    marginTop: 0,
  },
  bannerImage: {
    width: '100%',
    height: 120,
  },
  bannerFallback: {
    backgroundColor: '#1a1a2e',
    padding: 16,
  },
  bannerTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  bannerDesc: {
    color: '#ccc',
    fontSize: 12,
    marginTop: 4,
  },
  floating: {
    position: 'absolute',
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  floatingImage: {
    width: 60,
    height: 60,
  },
  floatingFallback: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  popupContent: {
    width: SCREEN_W * 0.85,
    maxHeight: SCREEN_H * 0.7,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  popupImage: {
    width: '100%',
    height: 200,
  },
  popupBody: {
    padding: 20,
  },
  popupTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000',
    marginBottom: 8,
  },
  popupDesc: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  popupClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupCloseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
