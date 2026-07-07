import React from 'react'
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native'
import ChatPanel from './src/components/ChatPanel'

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar />
      <ChatPanel />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7fafc' }
})
