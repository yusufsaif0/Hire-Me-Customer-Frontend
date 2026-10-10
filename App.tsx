import { AuthScreen } from './src/auth/AuthScreen';
export default function App() {
  return (
    <AuthScreen
      role="CUSTOMER"
      apiUrl={process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:4001'}
    />
  );
}
