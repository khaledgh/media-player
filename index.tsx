import { registerRootComponent } from "expo";
import App from "./App";
import { SafeAreaProvider } from "react-native-safe-area-context";
import React from "react";

const Root = () => (
  <SafeAreaProvider>
    <App />
  </SafeAreaProvider>
);

registerRootComponent(Root);
