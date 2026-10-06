import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

// P0-2 fix: 404 page was blinding white. Hardcode dark palette.
const C = {
  background: '#07020F',
  foreground: '#FFFFFF',
  primary: '#8B5CF6',
} as const;

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <Text style={[styles.title, { color: C.foreground }]}>
          This screen doesn&apos;t exist.
        </Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: C.primary }]}>
            Go to home screen!
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
