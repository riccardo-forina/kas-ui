import {
  asKafkaRequestPayload,
  createEmptyNewKafkaRequestPayload,
} from '@app/models/kafka';
import {
  CreateKafkaInitializationData,
  InstanceAvailability,
  InstanceType,
  OnCreateKafka,
  Provider,
  ProviderInfo,
  Providers,
  RegionInfo,
  Regions,
} from '@rhoas/app-services-ui-components';
import {
  Quota,
  QuotaType,
  QuotaValue,
  useAuth,
  useConfig,
  useQuota,
} from '@rhoas/app-services-ui-shared';
import { Configuration, DefaultApi } from '@rhoas/kafka-management-sdk';
import { isServiceApiError } from '@app/utils/error';
import { ErrorCodes } from '@app/utils';

export const useAvailableProvidersAndDefault = () => {
  const auth = useAuth();
  const {
    kas: { apiBasePath: basePath },
  } = useConfig();
  const { getQuota } = useQuota();

  const apisService = new DefaultApi(
    new Configuration({
      accessToken: auth.kas.getToken(),
      basePath,
    })
  );

  const fetchQuota = async (): Promise<Quota['data']> => {
    return new Promise((resolve, reject) => {
      async function getQuotaData() {
        const quota = await getQuota();
        if (quota.isServiceDown) {
          reject();
        } else if (quota.loading) {
          setTimeout(getQuota, 1000);
        } else {
          resolve(quota.data);
        }
      }
      getQuotaData();
    });
  };

  // Function to fetch cloud Regions based on selected filter
  const fetchRegions = async (id: string): Promise<Regions> => {
    const res = await apisService.getCloudProviderRegions(id);
    return (res.data.items || [])
      .filter((p) => p.enabled)
      .map((r): RegionInfo => {
        return {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          id: r.id!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          displayName: r.display_name!,
        };
      });
  };

  const fetchProviders = async (): Promise<Providers> => {
    const res = await apisService.getCloudProviders();
    const allProviders = res?.data?.items || [];
    return await Promise.all(
      allProviders
        .filter((p) => p.enabled)
        .map(async (provider): Promise<ProviderInfo> => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const regions = await fetchRegions(provider.id!);
          return {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            id: provider.id!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            displayName: provider.display_name!,
            regions,
            AZ: {
              single: false,
              multi: true,
            },
          };
        })
    );
  };

  const fetchUserHasTrialInstance = async (): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const loggedInUser = await auth.getUsername()!;
    const accessToken = await auth.kas.getToken();
    const filter = `owner = ${loggedInUser}`;
    try {
      const apisService = new DefaultApi(
        new Configuration({
          accessToken,
          basePath,
        })
      );
      const res = await apisService.getKafkas('', '', '', filter);
      if (res.data.items) {
        return res.data.items.some(
          (k) => k?.instance_type === InstanceType?.eval
        );
      }
    } catch {
      // noop
    }
    return false;
  };

  return async function (): Promise<CreateKafkaInitializationData> {
    const quota = await fetchQuota();
    const hasTrialRunning = await fetchUserHasTrialInstance();

    const kasQuota: QuotaValue | undefined = quota?.get(QuotaType?.kas);

    const availableProviders = await fetchProviders();
    const defaultProvider: Provider | undefined =
      availableProviders.length === 1 ? availableProviders[0].id : undefined;

    const instanceAvailability = ((): InstanceAvailability => {
      switch (true) {
        case kasQuota !== undefined && kasQuota.remaining > 0:
          return 'quota';
        case hasTrialRunning:
          return 'trial-used';
        // TODO check if trial instances are available for creation using the info returned by the region endpoint
        // TODO also check if there is any capacity for standar instances, as for the trial ones
        default:
          return 'trial';
      }
    })();

    return {
      defaultProvider,
      defaultAZ: 'multi',
      availableProviders,
      instanceAvailability,
    };
  };
};

export const useCreateInstance = (): OnCreateKafka => {
  const auth = useAuth();
  const {
    kas: { apiBasePath: basePath },
  } = useConfig();

  const apisService = new DefaultApi(
    new Configuration({
      accessToken: auth?.kas.getToken(),
      basePath,
    })
  );

  return async (data, onSuccess, onError) => {
    try {
      const kafkaRequest = asKafkaRequestPayload(
        createEmptyNewKafkaRequestPayload()
      );
      kafkaRequest.name = data.name;
      kafkaRequest.cloud_provider = data.provider;
      kafkaRequest.region = data.region;
      kafkaRequest.multi_az = data.az === 'multi';
      await apisService.createKafka(true, kafkaRequest);
      onSuccess();
    } catch (error) {
      if (isServiceApiError(error)) {
        const { code } = error?.response?.data || {};

        switch (code) {
          case ErrorCodes.DUPLICATE_INSTANCE_NAME:
            onError('name-taken');
            break;
          case ErrorCodes.INSUFFICIENT_QUOTA:
            onError('over-quota');
            break;
          default:
            onError('unknown');
        }
      }
    }
  };
};
