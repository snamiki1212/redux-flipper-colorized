import { addPlugin, Flipper } from 'react-native-flipper';
import * as dayjs from 'dayjs';

export type Configuration = {
  resolveCyclic?: boolean;
  actionsBlacklist?: Array<string>;
  stateWhitelist?: string[];
};

const defaultConfig: Configuration = {
  resolveCyclic: false,
  actionsBlacklist: [],
};

let currentConnection: Flipper.FlipperConnection | null = null;

const error = {
  NO_STORE: 'NO_STORE',
};

const createStateForAction = (state: any, config: Configuration) => {
  return config.stateWhitelist
    ? config.stateWhitelist.reduce(
        (acc, stateWhitelistedKey) => ({
          ...acc,
          [stateWhitelistedKey]: state[stateWhitelistedKey],
        }),
        {},
      )
    : state;
};

// To initiate initial state tree
const createInitialAction = (store: any, config: Configuration) => {
  const startTime = Date.now();
  let initState = store.getState();

  if (config.resolveCyclic) {
    const cycle = require('cycle');

    initState = cycle.decycle(initState);
  }

  let state = {
    id: startTime,
    time: dayjs(startTime).format('HH:mm:ss.SSS'),
    took: `-`,
    action: { type: '@@INIT' },
    before: createStateForAction({}, config),
    after: createStateForAction(initState, config),
  };

  currentConnection?.send('actionInit', state);
};

const createDebugger =
  (config = defaultConfig) =>
  (store: any) => {
    if (currentConnection == null) {
      addPlugin({
        getId() {
          return 'flipper-plugin-redux-debugger-colorized';
        },
        onConnect(connection: any) {
          currentConnection = connection;

          currentConnection?.receive(
            'dispatchAction',
            (data: any, responder: any) => {
              console.log('flipper redux dispatch action data', data);
              // respond with some data
              if (store) {
                store.dispatch({ type: data.type, ...data.payload });

                responder.success({
                  ack: true,
                });
              } else {
                responder.success({
                  error: error.NO_STORE,
                  message: 'store is not setup in flipper plugin',
                });
              }
            },
          );

          createInitialAction(store, config);
        },
        onDisconnect() {
          currentConnection = null;
        },
        runInBackground() {
          return true;
        },
      });
    } else {
      createInitialAction(store, config);
    }

    return (next: any) => (action: { type: string }) => {
      let startTime = Date.now();
      let before = store.getState();
      let result = next(action);
      if (currentConnection) {
        let after = store.getState();
        let now = Date.now();
        let decycledAction = null;

        if (config.resolveCyclic) {
          const cycle = require('cycle');

          before = cycle.decycle(before);
          after = cycle.decycle(after);
          decycledAction = cycle.decycle(action);
        }

        let state = {
          id: startTime,
          time: dayjs(startTime).format('HH:mm:ss.SSS'),
          took: `${now - startTime} ms`,
          action: decycledAction || action,
          before: createStateForAction(before, config),
          after: createStateForAction(after, config),
        };

        const blackListed = !!config.actionsBlacklist?.some(
          (blacklistedActionType) =>
            action.type?.includes(blacklistedActionType),
        );
        if (!blackListed) {
          currentConnection.send('actionDispatched', state);
        }
      }

      return result;
    };
  };

export default createDebugger;
