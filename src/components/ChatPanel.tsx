import React, { useState } from 'react'
import { View, Text, TextInput, Button, ScrollView, StyleSheet } from 'react-native'

type Message = { id: number; text: string; from: 'user' | 'bot' }

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')

  function send() {
    if (!input.trim()) return
    const msg: Message = { id: Date.now(), text: input.trim(), from: 'user' }
    setMessages((m) => [...m, msg, { id: msg.id + 1, text: '응답: ' + msg.text, from: 'bot' }])
    setInput('')
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.messages} contentContainerStyle={{ padding: 8 }}>
        {messages.map((m) => (
          <View key={m.id} style={[styles.message, m.from === 'user' ? styles.user : styles.bot]}>
            <Text>{m.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="메시지를 입력하세요"
          style={styles.input}
        />
        <Button title="전송" onPress={send} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messages: { flex: 1 },
  message: { padding: 8, borderRadius: 6, marginVertical: 6, alignSelf: 'flex-start' },
  user: { backgroundColor: '#e6f0ff', alignSelf: 'flex-end' },
  bot: { backgroundColor: '#f1f5f9' },
  composer: { flexDirection: 'row', padding: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', padding: 8, borderRadius: 6, marginRight: 8 }
})
