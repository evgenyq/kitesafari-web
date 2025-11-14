import { Layout } from '../../components/Layout/Layout'
import styles from './NotFoundPage.module.css'

export function NotFoundPage() {
  return (
    <Layout>
      <div className={styles.container}>
        <h1 className={styles.title}>404</h1>
        <h2 className={styles.subtitle}>Страница не найдена</h2>
        <p className={styles.text}>
          Проверьте правильность введенного кода доступа к трипу
        </p>
      </div>
    </Layout>
  )
}
