import { Layout } from '../../components/Layout/Layout'
import styles from './OnboardingPage.module.css'

export function OnboardingPage() {
  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.icon}>👋</div>
        <h1 className={styles.title}>Добро пожаловать!</h1>
        <p className={styles.text}>
          Для начала работы с ботом вам нужна ссылка на бронирование от организаторов.
        </p>
        <div className={styles.contacts}>
          <p className={styles.contactsTitle}>Контакты организаторов:</p>
          <p className={styles.contact}>• @evgenyq</p>
        </div>
      </div>
    </Layout>
  )
}
