import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import {
  AlertContext,
  Auth,
  AuthContext,
  Config,
  ConfigContext,
  ModalContext,
} from '@rhoas/app-services-ui-shared';
import { KasModalLoader } from '@app/modals';
import { InstanceDrawerContextProvider } from '@app/modules/InstanceDrawer/contexts/InstanceDrawerContext';

const kafkaInstanceItems = [
  {
    id: '1iSY6RQ3JKI8Q0OTmjQFd3ocFRg',
    kind: 'kafka',
    href: '/api/managed-services-api/v1/kafkas/1iSY6RQ3JKI8Q0OTmjQFd3ocFRg',
    status: 'ready',
    cloud_provider: 'aws',
    multi_az: false,
    region: 'us-east-1',
    owner: 'api_kafka_service',
    name: 'serviceapi',
    bootstrap_server_host:
      'serviceapi-1isy6rq3jki8q0otmjqfd3ocfrg.apps.ms-bttg0jn170hp.x5u8.s1.devshift.org',
    created_at: '2020-10-05T12:51:24.053142Z',
    updated_at: '2020-10-05T12:56:36.362208Z',
  },
];

const actualSDK = jest.requireActual('@rhoas/kafka-management-sdk');

jest.mock('@rhoas/kafka-management-sdk', () => {
  return {
    ...actualSDK,
    DefaultApi: jest.fn().mockImplementation(() => {
      return {
        deleteKafkaById: () => Promise.resolve(),
      };
    }),
  };
});

import { StreamsTable } from '@app/modules/OpenshiftStreams/components';

describe('<StreamsTable/>', () => {
  const setup = (
    args: any,
    authValue = {
      kas: {
        getToken: () => Promise.resolve('test-token'),
      },
      getUsername: () => Promise.resolve('api_kafka_service'),
      isOrgAdmin: () => Promise.resolve(true),
    } as Auth
  ) => {
    render(
      <MemoryRouter>
        <ModalContext.Provider
          value={{
            registerModals: () => '',
            showModal: () => '',
            hideModal: () => '',
          }}
        >
          <ConfigContext.Provider
            value={
              {
                kas: {
                  apiBasePath: '',
                },
              } as Config
            }
          >
            <AuthContext.Provider value={authValue}>
              <AlertContext.Provider
                value={{
                  addAlert: () => {
                    // No-op
                  },
                }}
              >
                <InstanceDrawerContextProvider>
                  <StreamsTable {...args} />
                </InstanceDrawerContextProvider>
              </AlertContext.Provider>
            </AuthContext.Provider>
          </ConfigContext.Provider>
          <KasModalLoader />
        </ModalContext.Provider>
      </MemoryRouter>
    );
  };

  const props = {
    createStreamsInstance: false,
    setCreateStreamsInstance: jest.fn(),
    kafkaInstanceItems,
    onViewInstance: jest.fn(),
    onViewConnection: jest.fn(),
    mainToggle: false,
    refresh: jest.fn(),
    page: 1,
    perPage: 10,
    total: 1,
    kafkaDataLoaded: true,
    expectedTotal: 1,
    filteredValue: [],
    setFilteredValue: jest.fn(),
    filterSelected: '',
    setFilterSelected: jest.fn(),
    orderBy: '',
    setOrderBy: jest.fn(),
  };

  it('should render translation text in English language', () => {
    //arrange
    setup(props);

    //assert
    expect(screen.getByText('us-east-1')).toBeInTheDocument();
  });

  it('should disable the delete kebab button if the ower and loggedInUser are not the same', () => {
    //arrange
    const newProps = Object.assign({}, props);
    newProps.kafkaInstanceItems[0].owner = 'test-user';
    setup(newProps);

    //act
    const kebabDropdownButton: any =
      screen.getByText('test-user')?.parentElement?.lastChild?.lastChild
        ?.lastChild;
    act(() => {
      userEvent.click(kebabDropdownButton);
    });
    const classList: string[] = screen
      .getByRole('button', { name: /Delete/i })
      .className.split(' ');

    //assert
    expect(classList).toContain('pf-m-disabled');
  });
});
